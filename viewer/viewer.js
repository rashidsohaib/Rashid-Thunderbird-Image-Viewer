/* viewer/viewer.js */
"use strict";

(async () => {
  // ── Load session from storage ─────────────────────────────────────────────
  let images = [], current = 0;
  for (let i = 0; i < 10; i++) {
    try {
      const r = await browser.storage.local.get("imageEnlargerSession");
      if (r.imageEnlargerSession) {
        images  = r.imageEnlargerSession.images        || [];
        current = r.imageEnlargerSession.currentIndex  || 0;
        await browser.storage.local.remove("imageEnlargerSession");
        break;
      }
    } catch(e) { /* retry */ }
    await new Promise(r => setTimeout(r, 300));
  }

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const imgEl    = document.getElementById("mainImg");
  const stage    = document.getElementById("stage");
  const counter  = document.getElementById("counter");
  const zoomLbl  = document.getElementById("zoomLabel");
  const fName    = document.getElementById("fName");
  const fDims    = document.getElementById("fDims");
  const spinner  = document.getElementById("spinner");

  // ── State ─────────────────────────────────────────────────────────────────
  let scale = 1, panX = 0, panY = 0, panning = false, panOrig = {x:0,y:0};

  function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

  function applyTransform() {
    imgEl.style.transform = `translate(${panX}px,${panY}px) scale(${scale})`;
    zoomLbl.textContent = Math.round(scale * 100) + "%";
  }

  function fitScale() {
    const sw = stage.clientWidth  - 20;
    const sh = stage.clientHeight - 20;
    const iw = imgEl.naturalWidth  || 1;
    const ih = imgEl.naturalHeight || 1;
    return clamp(Math.min(sw / iw, sh / ih), 0.05, 4);
  }

  function loadImage(idx) {
    if (!images.length) { spinner.textContent = "No images"; spinner.classList.add("on"); return; }
    current = ((idx % images.length) + images.length) % images.length;
    const img = images[current];

    scale = 1; panX = 0; panY = 0;
    imgEl.classList.add("loading");
    spinner.classList.add("on");
    imgEl.src = img.src;
    imgEl.alt = img.name || "";

    counter.textContent = `${current + 1} / ${images.length}`;
    const name = img.name || "Image";
    fName.textContent = name;
    fDims.textContent = img.size ? `${img.size.toLocaleString()} bytes` : "";

    document.getElementById("bPrev").disabled = images.length <= 1;
    document.getElementById("bNext").disabled = images.length <= 1;
  }

  imgEl.addEventListener("load", () => {
    imgEl.classList.remove("loading");
    spinner.classList.remove("on");
    fDims.textContent = `${imgEl.naturalWidth} × ${imgEl.naturalHeight} px`;
    // Always start at 100% — user can press Fit if needed
    scale = 1; panX = 0; panY = 0;
    applyTransform();
  });

  imgEl.addEventListener("error", () => {
    spinner.textContent = "⚠ Failed to load";
    spinner.classList.add("on");
    imgEl.classList.remove("loading");
  });

  // ── Buttons ───────────────────────────────────────────────────────────────
  document.getElementById("bPrev").addEventListener("click", () => loadImage(current - 1));
  document.getElementById("bNext").addEventListener("click", () => loadImage(current + 1));
  document.getElementById("bZoomIn").addEventListener("click",  () => { scale = clamp(scale * 1.25, 0.05, 16); applyTransform(); });
  document.getElementById("bZoomOut").addEventListener("click", () => { scale = clamp(scale / 1.25, 0.05, 16); applyTransform(); });
  document.getElementById("bReset").addEventListener("click",   () => { scale = 1; panX = 0; panY = 0; applyTransform(); });
  document.getElementById("bFit").addEventListener("click",     () => { scale = fitScale(); panX = 0; panY = 0; applyTransform(); });
  document.getElementById("bClose").addEventListener("click",   () => window.close());
  document.getElementById("bSave").addEventListener("click", () => {
    if (!images[current]) return;
    const a = document.createElement("a");
    a.href = images[current].src;
    a.download = images[current].name || "image";
    a.click();
  });

  // ── Mouse wheel zoom ──────────────────────────────────────────────────────
  stage.addEventListener("wheel", e => {
    e.preventDefault();
    scale = clamp(scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1), 0.05, 16);
    applyTransform();
  }, { passive: false });

  // ── Pan ───────────────────────────────────────────────────────────────────
  stage.addEventListener("mousedown", e => {
    if (e.button !== 0) return;
    panning = true;
    panOrig = { x: e.clientX - panX, y: e.clientY - panY };
    stage.classList.add("panning");
  });
  window.addEventListener("mousemove", e => {
    if (!panning) return;
    panX = e.clientX - panOrig.x;
    panY = e.clientY - panOrig.y;
    applyTransform();
  });
  window.addEventListener("mouseup", () => { panning = false; stage.classList.remove("panning"); });

  // ── Keyboard ──────────────────────────────────────────────────────────────
  window.addEventListener("keydown", e => {
    switch (e.key) {
      case "ArrowLeft":  case "ArrowUp":    loadImage(current - 1); break;
      case "ArrowRight": case "ArrowDown":  loadImage(current + 1); break;
      case "+": case "=": scale = clamp(scale * 1.25, 0.05, 16); applyTransform(); break;
      case "-":           scale = clamp(scale / 1.25, 0.05, 16); applyTransform(); break;
      case "0":           scale = 1; panX = 0; panY = 0; applyTransform(); break;
      case "f": case "F": scale = fitScale(); panX = 0; panY = 0; applyTransform(); break;
      case "Escape":      window.close(); break;
    }
  });

  // ── Init ──────────────────────────────────────────────────────────────────
  document.title = "Rashid-Thunderbird-Image-Viewer";
  if (images.length) loadImage(current);
  else { spinner.textContent = "No images found"; spinner.classList.add("on"); }

})();
