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
  var syncing = false;
  var syncQueued = false;

  function getCart() {
    return fetch('/cart.js', {headers: {Accept: 'application/json'}}).then(function (res) {
      if (!res.ok) {
        throw new Error('Failed to load cart (' + res.status + ')');
      }
      return res.json();
    });
  }

  function addGift() {
    return fetch('/cart/add.js', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Accept: 'application/json'},
      body: JSON.stringify({items: [{id: giftVariantId, quantity: 1}]}),
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
        var giftLine = cart.items.find(function (item) {
          return item.variant_id === giftVariantId;
        });
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

  watchCartMutations();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncGiftLine);
  } else {
    syncGiftLine();
  }
})();
