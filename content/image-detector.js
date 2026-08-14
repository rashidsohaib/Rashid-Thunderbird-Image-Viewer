/* content/image-detector.js
 * Injected by messageDisplayScripts into every rendered email.
 * Marks visible images and sends click events to the background.
 */
(function () {
  "use strict";
  if (window.__imgEnlarger) return;
  window.__imgEnlarger = true;

  function isVisible(img) {
    return (img.naturalWidth || img.width || 0) >= 16 &&
           (img.naturalHeight || img.height || 0) >= 16;
  }

  function bindAll() {
    const imgs = Array.from(document.querySelectorAll("img")).filter(isVisible);
    imgs.forEach((img, idx) => {
      if (img.dataset.enl) return;
      img.dataset.enl = "1";
      img.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        browser.runtime.sendMessage({ action: "imageClicked", clickedIndex: idx });
      });
    });
  }

  bindAll();
  setTimeout(bindAll, 600);
  setTimeout(bindAll, 2500);
  new MutationObserver(bindAll).observe(document.documentElement,
    { childList: true, subtree: true });
})();
