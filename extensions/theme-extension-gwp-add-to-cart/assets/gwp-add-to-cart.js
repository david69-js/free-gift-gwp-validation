(function () {
  var configEl = document.getElementById('gwp-config');
  if (!configEl) {
    return;
  }

  var config;
  try {
    config = JSON.parse(configEl.textContent);
  } catch (e) {
    return;
  }

  if (!config.gift_variant_id) {
    return;
  }

  var giftVariantId = Number(String(config.gift_variant_id).split('/').pop());
  var minSubtotal = Number(config.min_subtotal);
  var CART_MUTATION_PATH = /\/cart\/(add|change|update|clear)(\.js)?(\?|$)/;
  var GIFT_MARKER_KEY = '_gwp_gift';
  var GIFT_MESSAGE_KEY = 'Gift';
  var GIFT_MESSAGE_VALUE = '🎁 Free gift with your order';
  var syncing = false;
  var syncQueued = false;

  function isGiftLine(item) {
    return item.variant_id === giftVariantId && item.properties && item.properties[GIFT_MARKER_KEY] === 'true';
  }

  function getCart() {
    return fetch('/cart.js', {headers: {Accept: 'application/json'}}).then(function (res) {
      if (!res.ok) {
        throw new Error('Failed to load cart (' + res.status + ')');
      }
      return res.json();
    });
  }

  function addGift() {
    var properties = {};
    properties[GIFT_MARKER_KEY] = 'true';
    properties[GIFT_MESSAGE_KEY] = GIFT_MESSAGE_VALUE;

    return fetch('/cart/add.js', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Accept: 'application/json'},
      body: JSON.stringify({items: [{id: giftVariantId, quantity: 1, properties: properties}]}),
    });
  }

  function setLineQuantity(lineKey, quantity) {
    return fetch('/cart/change.js', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Accept: 'application/json'},
      body: JSON.stringify({id: lineKey, quantity: quantity}),
    });
  }

  function syncGiftLine() {
    if (syncing) {
      syncQueued = true;
      return;
    }
    syncing = true;

    getCart()
      .then(function (cart) {
        var giftLine = cart.items.find(isGiftLine);
        var giftLineTotal = giftLine ? giftLine.line_price : 0;
        var subtotalExcludingGift = (cart.items_subtotal_price != null ? cart.items_subtotal_price : cart.total_price) - giftLineTotal;
        var qualifies = subtotalExcludingGift / 100 >= minSubtotal;

        if (qualifies && !giftLine) {
          return addGift();
        }
        if (qualifies && giftLine && giftLine.quantity > 1) {
          return setLineQuantity(giftLine.key, 1);
        }
        if (!qualifies && giftLine) {
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

  // Cart mutations happen through many different theme code paths
  // (custom fetch calls, XHR, form submits handled by theme JS). Watching
  // the network layer directly is the only reliable, theme-agnostic way to
  // notice "the cart changed" and re-run the gift check afterward.
  function watchCartMutations() {
    var originalFetch = window.fetch;
    window.fetch = function () {
      var url = arguments[0] && arguments[0].url ? arguments[0].url : arguments[0];
      var result = originalFetch.apply(this, arguments);
      if (typeof url === 'string' && CART_MUTATION_PATH.test(url)) {
        result.then(function () {
          setTimeout(syncGiftLine, 250);
        });
      }
      return result;
    };

    var originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      if (typeof url === 'string' && CART_MUTATION_PATH.test(url)) {
        this.addEventListener('loadend', function () {
          setTimeout(syncGiftLine, 250);
        });
      }
      return originalOpen.apply(this, arguments);
    };
  }

  // Belt-and-suspenders: some themes cache their own reference to `fetch`
  // before this script runs (bypassing the patch above), or mutate the cart
  // through a path we don't recognize. Polling guarantees we notice a change
  // within a few seconds regardless of how the theme's add-to-cart works.
  function pollCart() {
    setInterval(syncGiftLine, 2500);
  }

  var COMMON_CART_EVENTS = ['cart:updated', 'cart:refresh', 'cart:build', 'cart:change', 'cart:update'];

  function watchCommonCartEvents() {
    COMMON_CART_EVENTS.forEach(function (eventName) {
      document.addEventListener(eventName, function () {
        setTimeout(syncGiftLine, 250);
      });
    });
  }

  watchCartMutations();
  watchCommonCartEvents();
  pollCart();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncGiftLine);
  } else {
    syncGiftLine();
  }
})();
