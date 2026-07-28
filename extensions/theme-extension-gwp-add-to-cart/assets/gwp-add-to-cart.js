(function () {
  var configEl = document.getElementById('gwp-config');
  if (!configEl) {
    console.log('[GWP] no #gwp-config script tag found on page');
    return;
  }

  var config;
  try {
    config = JSON.parse(configEl.textContent);
  } catch (e) {
    console.error('[GWP] failed to parse #gwp-config JSON', e, configEl.textContent);
    return;
  }

  console.log('[GWP] loaded config', config);

  // Only truly bail (never track the cart at all) if we can't even identify
  // which variant is "the gift" - without that we have nothing to clean up
  // either. Every other condition below (status, country/currency, test
  // mode) must NOT just stop and do nothing: if the customer already has
  // the gift line and a condition stops applying (e.g. they switch their
  // market from US to another country mid-session), we still need to
  // actively remove it - not just leave it sitting in the cart forever.
  if (!config.gift_variant_id) {
    console.log('[GWP] no gift_variant_id in config, stopping');
    return;
  }

  var giftVariantId = Number(String(config.gift_variant_id).split('/').pop());
  var minSubtotal = Number(config.min_subtotal);
  var GIFT_MARKER_KEY = '_gwp_gift';
  var GIFT_MESSAGE_KEY = 'Gift';
  var GIFT_MESSAGE_VALUE = '🎁 Free gift with your order';
  var syncing = false;
  var syncQueued = false;

  function hasLiquidAjaxCart() {
    return typeof window.liquidAjaxCart !== 'undefined' && window.liquidAjaxCart !== null;
  }

  function isGiftLine(item) {
    return item.variant_id === giftVariantId && item.properties && item.properties[GIFT_MARKER_KEY] === 'true';
  }

  // Re-checked on every sync (not just once at page load) so a customer
  // switching country/market, or a merchant flipping status/test mode,
  // takes effect on the very next sync - not just on their next page load.
  function offerApplies() {
    if (config.status !== 'active') {
      return false;
    }
    if (config.country !== 'US' || config.currency !== 'USD') {
      return false;
    }
    if (config.test_mode) {
      var testTags = Array.isArray(config.test_tag) ? config.test_tag : [];
      var customerTags = Array.isArray(config.customer_tags) ? config.customer_tags : [];
      var hasTestTag = testTags.some(function (tag) {
        return customerTags.indexOf(tag) !== -1;
      });
      if (!hasTestTag) {
        return false;
      }
    }
    return true;
  }

  function getCart() {
    if (hasLiquidAjaxCart() && window.liquidAjaxCart.cart) {
      return Promise.resolve(window.liquidAjaxCart.cart);
    }
    return fetch('/cart.js', {headers: {Accept: 'application/json'}}).then(function (res) {
      if (!res.ok) {
        throw new Error('Failed to load cart (' + res.status + ')');
      }
      return res.json();
    });
  }

  // Liquid Ajax Cart (https://liquid-ajax-cart.js.org) queues its requests -
  // using its own add/change methods means our mutation runs in the SAME
  // queue as the theme's own actions (never concurrently), which is what
  // avoids the cart getting stuck when we and the customer act at once.
  function addGift() {
    var properties = {};
    properties[GIFT_MARKER_KEY] = 'true';
    properties[GIFT_MESSAGE_KEY] = GIFT_MESSAGE_VALUE;
    var items = [{id: giftVariantId, quantity: 1, properties: properties}];

    if (hasLiquidAjaxCart()) {
      return window.liquidAjaxCart.add({items: items});
    }

    return fetch('/cart/add.js', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Accept: 'application/json'},
      body: JSON.stringify({items: items}),
    });
  }

  function setLineQuantity(lineKey, quantity) {
    if (hasLiquidAjaxCart()) {
      return window.liquidAjaxCart.change({id: lineKey, quantity: quantity});
    }

    return fetch('/cart/change.js', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Accept: 'application/json'},
      body: JSON.stringify({id: lineKey, quantity: quantity}),
    });
  }

  function syncGiftLine(cartOverride) {
    if (syncing) {
      syncQueued = true;
      return;
    }
    syncing = true;

    Promise.resolve(cartOverride || getCart())
      .then(function (cart) {
        var giftLine = cart.items.find(isGiftLine);
        var applies = offerApplies();

        if (!applies) {
          console.log('[GWP] offer does not apply right now (status/country/currency/test mode), cleaning up', {
            status: config.status, country: config.country, currency: config.currency, giftLineFound: Boolean(giftLine),
          });
          if (giftLine) {
            console.log('[GWP] removing gift, offer no longer applies');
            return setLineQuantity(giftLine.key, 0);
          }
          return;
        }

        var giftLineTotal = giftLine ? giftLine.line_price : 0;
        var subtotalExcludingGift = (cart.items_subtotal_price != null ? cart.items_subtotal_price : cart.total_price) - giftLineTotal;
        var qualifies = subtotalExcludingGift / 100 >= minSubtotal;

        console.log('[GWP] sync', {
          subtotalExcludingGift: subtotalExcludingGift / 100,
          minSubtotal: minSubtotal,
          qualifies: qualifies,
          giftLineFound: Boolean(giftLine),
          cartItems: cart.items.map(function (i) { return {variant_id: i.variant_id, properties: i.properties}; }),
        });

        if (qualifies && !giftLine) {
          console.log('[GWP] adding gift');
          return addGift();
        }
        if (qualifies && giftLine && giftLine.quantity > 1) {
          return setLineQuantity(giftLine.key, 1);
        }
        if (!qualifies && giftLine) {
          console.log('[GWP] removing gift, no longer qualifies');
          return setLineQuantity(giftLine.key, 0);
        }
      })
      .catch(function (e) {
        console.error('GWP add-to-cart sync failed', e);
      })
      .finally(function () {
        syncing = false;
        if (syncQueued) {
          syncQueued = false;
          syncGiftLine();
        }
      });
  }

  // Preferred path: Liquid Ajax Cart dispatches this after every cart
  // request it performs (its own queue AND ours, since we use its API too),
  // with the fresh cart already in event.detail.cart - no extra fetch,
  // and no risk of racing an in-flight request since everything is queued.
  function watchLiquidAjaxCart() {
    document.addEventListener('liquid-ajax-cart:request-end', function (event) {
      var cart = event.detail && event.detail.cart;
      syncGiftLine(cart);
    });
    document.addEventListener('liquid-ajax-cart:init', function () {
      syncGiftLine();
    });
  }

  // Fallback for themes that don't use Liquid Ajax Cart: listen for the
  // handful of custom cart-update events most themes dispatch, and poll as
  // the last-resort safety net. The poll interval is deliberately long (10s):
  // without a queueing mechanism, a short interval risks colliding with the
  // theme's own in-flight cart request and leaving its cart UI stuck.
  var COMMON_CART_EVENTS = ['cart:updated', 'cart:refresh', 'cart:build', 'cart:change', 'cart:update'];

  function watchCommonCartEvents() {
    COMMON_CART_EVENTS.forEach(function (eventName) {
      document.addEventListener(eventName, function () {
        setTimeout(function () { syncGiftLine(); }, 250);
      });
    });
  }

  function pollCart() {
    setInterval(function () { syncGiftLine(); }, 10000);
  }

  // Registered unconditionally (harmless if unused): Liquid Ajax Cart might
  // not be initialized yet at this exact point even if the theme uses it.
  watchLiquidAjaxCart();
  watchCommonCartEvents();
  pollCart();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { syncGiftLine(); });
  } else {
    syncGiftLine();
  }
})();
