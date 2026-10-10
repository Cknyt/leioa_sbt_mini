// Se carga en <head> y sin defer para aplicar el tema antes de pintar (evita parpadeo).
(function () {
  try {
    var t = localStorage.getItem('tema');
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  } catch (e) {}
})();
