// Поведение приложения, а не сайта: без контекстного меню, перетаскивания, выделения и зума страницы.
// Поля ввода (имена, суммы, чат) работают как обычно.

const editable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t.closest('input, textarea, select') !== null);

export function installAppFeel() {
  // правая кнопка / долгое нажатие — без меню браузера
  document.addEventListener('contextmenu', (e) => { if (!editable(e.target)) e.preventDefault(); });
  // картинки и ссылки не перетаскиваются
  document.addEventListener('dragstart', (e) => { if (!editable(e.target)) e.preventDefault(); });
  // выделение текста (двойной клик, протягивание) — только в полях ввода
  document.addEventListener('selectstart', (e) => { if (!editable(e.target)) e.preventDefault(); });
  // зум страницы: Ctrl/⌘ + колесо и щипок на тачпаде (приходит как wheel с ctrlKey) — колесо без Ctrl крутит камеру
  window.addEventListener('wheel', (e) => { if (e.ctrlKey || e.metaKey) e.preventDefault(); }, { passive: false });
  // зум с клавиатуры: Ctrl/⌘ + «+», «−», «0»
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && ['+', '=', '-', '_', '0'].includes(e.key)) e.preventDefault();
  });
  // щипок в Safari (iOS игнорирует user-scalable=no)
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, (e) => e.preventDefault());
}
