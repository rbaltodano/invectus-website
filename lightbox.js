// Ported from angrove-website (js/lightbox.js) by its author, for the inVectus site.
// Photos and videos open larger: clicked (or Return/Space when focused), one grows from its place
// to fill the screen while the page darkens behind it. A click, Esc, or scrolling sends it back.
// The element itself moves into the lightbox, so a video keeps playing; a video that has finished
// plays again. Decorative images (empty alt), the nav and footer, links elsewhere, and anything
// marked data-no-lightbox are left alone; an image linked to its own file opens here instead.
// Under it sit its heading and a line about it: data-caption-title and data-caption, else the
// figure's caption when the figure holds only this media, else its alt text.
// On hover (mouse or trackpad) each one grows 5% and turns slightly to face the cursor.
(function () {
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // The mobile menu's curve and timing (--ease-menu: 0.6s, its fade 0.45s), both ways.
  var EASE = 'cubic-bezier(0.55, 0, 0.17, 1)';
  function margin() { return innerWidth < 600 ? 16 : 56; }   // around the enlarged media
  var GAP = 20;        // between it and its caption
  var OPEN_MS = reduce ? 0 : 600, CLOSE_MS = reduce ? 0 : 600, FADE_MS = reduce ? 0 : 450;
  var TILT = 4;   // degrees at the edges: subtle

  var IMAGE_FILE = /\.(jpe?g|png|webp|gif|avif)([?#]|$)/i;
  var media = Array.prototype.filter.call(document.querySelectorAll('img, video'), function (m) {
    if (m.getAttribute('alt') === '' || m.closest('.nav, .foot, [aria-hidden="true"], [data-no-lightbox], button')) return false;
    var link = m.closest('a');
    return !link || IMAGE_FILE.test(link.getAttribute('href') || '');
  });
  if (!media.length) return;

  media.forEach(function (m) {
    m.classList.add('lightbox-target');
    var link = m.closest('a');
    if (link) {
      // The link stays the keyboard stop; its click opens the image here rather than leaving.
      link.addEventListener('click', function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || shown) return;
        if (open(m)) { e.preventDefault(); shown.openedBy = e; }
      });
    } else {
      m.tabIndex = 0;
      m.setAttribute('role', 'button');
      m.addEventListener('click', function (e) { if (open(m)) shown.openedBy = e; });
      m.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(m); }
      });
    }
    if (!reduce) {
      m.addEventListener('pointermove', function (e) { tilt(m, e); });
      m.addEventListener('pointerleave', function () { untilt(m); });
    }
  });

  // The face turns toward the cursor: cursor right turns it right, cursor low turns it down.
  function tilt(m, e) {
    if (e.pointerType === 'touch' || shown) return;
    var r = m.getBoundingClientRect();
    var nx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
    var ny = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
    m.style.setProperty('--tilt-y', (nx * TILT).toFixed(2) + 'deg');
    m.style.setProperty('--tilt-x', (-ny * TILT).toFixed(2) + 'deg');
    m.classList.add('is-hovered');
  }
  function untilt(m) {
    m.classList.remove('is-hovered');
    m.style.removeProperty('--tilt-x');
    m.style.removeProperty('--tilt-y');
  }

  var shown = null;   // { media, placeholder, scrim, style, offset, rect, focus }

  function open(m) {
    if (shown) return false;
    var rect = m.getBoundingClientRect();
    if (rect.width < 120 || rect.height < 80) return false;   // hidden or too small to need it
    // Where it rests, without the hover's lift and tilt: where it returns to on close. The
    // transition is held off so this reads the resting place, not the hover mid-animation.
    m.style.setProperty('transition', 'none', 'important');
    m.style.setProperty('transform', 'none', 'important');
    m.style.setProperty('scale', 'none', 'important');
    var rest = m.getBoundingClientRect();
    untilt(m);
    m.style.removeProperty('transform');
    m.style.removeProperty('scale');
    m.style.removeProperty('transition');
    var cs = getComputedStyle(m);
    var MARGIN = margin();

    var scrim = document.createElement('div');
    scrim.className = 'lightbox';
    scrim.setAttribute('role', 'dialog');
    scrim.setAttribute('aria-modal', 'true');
    scrim.tabIndex = -1;
    // The dark layer fades on its own, so the media never fades with it.
    var shade = document.createElement('div');
    shade.className = 'lightbox__shade';
    scrim.appendChild(shade);
    document.body.appendChild(scrim);

    // The caption is measured first so the media fits the room it leaves.
    var caption = null, room = 0;
    var title = m.getAttribute('data-caption-title'), about = m.getAttribute('data-caption');
    if (!title && !about) {
      var figure = m.closest('figure'), figcaption = figure && figure.querySelector('figcaption');
      if (figcaption && figure.querySelectorAll('img, video').length === 1) {
        var head = figcaption.querySelector('h1, h2, h3, h4, h5, h6'), line = figcaption.querySelector('p');
        title = head && head.textContent.trim();
        about = line && line.textContent.trim();
      }
      if (!title && !about) about = m.getAttribute('alt') || m.getAttribute('aria-label');
    }
    if (title || about) {
      caption = document.createElement('div');
      caption.className = 'lightbox__caption';
      caption.id = 'lightbox-caption';
      if (title) caption.appendChild(text('h2', 'lightbox__title', title));
      if (about) caption.appendChild(text('p', 'lightbox__text', about));
      caption.style.width = Math.min(640, innerWidth - MARGIN * 2) + 'px';
      scrim.appendChild(caption);
      room = caption.offsetHeight + GAP;
      scrim.setAttribute('aria-labelledby', caption.id);
    } else {
      scrim.setAttribute('aria-label', m.getAttribute('alt') || m.getAttribute('aria-label') || 'Enlarged media');
    }

    // Fit the screen less a margin and the caption, never past the file's own size.
    var natural = m.naturalWidth || m.videoWidth || +m.getAttribute('width') || rect.width;
    var scale = Math.min((innerWidth - MARGIN * 2) / rest.width, (innerHeight - MARGIN * 2 - room) / rest.height);
    scale = Math.max(Math.min(1, scale), Math.min(scale, natural / rest.width));
    var w = rest.width * scale, h = rest.height * scale;
    var left = (innerWidth - w) / 2, top = (innerHeight - h - room) / 2;
    if (caption) {
      // Window captures carry a transparent shadow margin; the caption sits under the window.
      var inset = m.classList.contains('mac-shot') ? h * 0.04 : 0;
      caption.style.left = innerWidth / 2 + 'px';
      caption.style.top = (top + h - inset + GAP) + 'px';
    }

    // A stand-in holds its place in the page while it is away.
    var placeholder = document.createElement('span');
    placeholder.style.cssText = 'display:' + (cs.display === 'inline' ? 'inline-block' : cs.display) +
      ';width:' + m.offsetWidth + 'px;height:' + m.offsetHeight + 'px;margin:' + cs.margin + ';vertical-align:' + cs.verticalAlign;

    var style = m.getAttribute('style');
    var fit = cs.objectFit;
    // Corners set in px grow with it, so a phone recording keeps its shape.
    var radius = /%/.test(cs.borderRadius) ? cs.borderRadius : cs.borderRadius.replace(/[\d.]+px/g, function (v) { return parseFloat(v) * scale + 'px'; });
    m.replaceWith(placeholder);    // moved in one task, so a playing video doesn't pause
    scrim.appendChild(m);
    var pr = placeholder.getBoundingClientRect();
    m.style.cssText = 'position:fixed!important;left:' + left + 'px!important;top:' + top + 'px!important;' +
      'width:' + w + 'px!important;height:' + h + 'px!important;max-width:none!important;max-height:none!important;' +
      'margin:0!important;translate:none!important;transform-origin:0 0;border-radius:' + radius + ';object-fit:' + fit;
    m.classList.add('lightbox__media');

    shown = {
      media: m, placeholder: placeholder, scrim: scrim, shade: shade, caption: caption, style: style, focus: document.activeElement,
      offset: { x: rest.left - pr.left, y: rest.top - pr.top }, size: { w: w, h: h }, at: { x: left, y: top }
    };

    m.animate([{ transform: from(rect) }, { transform: 'none' }], { duration: OPEN_MS, easing: EASE });
    shade.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: EASE, fill: 'forwards' });
    if (caption) caption.animate([
      { opacity: 0, filter: 'blur(8px)', transform: 'translateY(6px)' },
      { opacity: 1, filter: 'blur(0)', transform: 'none' }
    ], { duration: reduce ? 0 : 400, delay: reduce ? 0 : 150, easing: 'ease-out', fill: 'backwards' });
    scrim.focus({ preventScroll: true });

    if (m.tagName === 'VIDEO' && !reduce && (m.paused || m.ended)) {
      if (m.ended) m.currentTime = 0;
      var playing = m.play();
      if (playing && playing.catch) playing.catch(function () {});
    }
    return true;
  }

  function text(tag, cls, value) {
    var node = document.createElement(tag);
    node.className = cls;
    node.textContent = value;
    return node;
  }

  // The transform that puts the enlarged element back over a rect on the page.
  function from(rect) {
    var s = shown.size, a = shown.at;
    return 'translate(' + (rect.left - a.x) + 'px, ' + (rect.top - a.y) + 'px) scale(' + (rect.width / s.w) + ', ' + (rect.height / s.h) + ')';
  }

  function close() {
    if (!shown || shown.closing) return;
    var s = shown;
    s.closing = true;
    var pr = s.placeholder.getBoundingClientRect();
    var home = { left: pr.left + s.offset.x, top: pr.top + s.offset.y, width: pr.width, height: pr.height };
    var back = s.media.animate([{ transform: 'none' }, { transform: from(home) }], { duration: CLOSE_MS, easing: EASE, fill: 'forwards' });
    if (s.caption) s.caption.animate([{ opacity: 1 }, { opacity: 0 }], { duration: CLOSE_MS * 0.5, easing: 'ease-in', fill: 'forwards' });
    s.shade.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: EASE, fill: 'forwards' });
    back.finished.then(function () {
      s.placeholder.replaceWith(s.media);
      s.media.classList.remove('lightbox__media');
      back.cancel();
      if (s.style == null) s.media.removeAttribute('style'); else s.media.setAttribute('style', s.style);
      s.scrim.remove();
      if (s.focus && s.focus.focus) s.focus.focus({ preventScroll: true });
      shown = null;
    });
  }

  document.addEventListener('click', function (e) {
    // The click that opened it bubbles here too, now from inside the lightbox: not a close.
    if (shown && e !== shown.openedBy && shown.scrim.contains(e.target)) { e.preventDefault(); close(); }
  });
  document.addEventListener('keydown', function (e) { if (shown && e.key === 'Escape') close(); });
  // Scrolling closes it rather than moving the page underneath.
  window.addEventListener('wheel', function (e) {
    if (!shown) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    close();
  }, { capture: true, passive: false });
  window.addEventListener('touchmove', function () { if (shown) close(); }, { passive: true });
})();
