// Status lines the app pushes while it finds or installs ai-memory and
// starts `ai-memory setup --web`. Text only: messages are never parsed as HTML.
window.showStatus = function (kind, message) {
  var item = document.createElement("li");
  item.className = kind;
  item.textContent = message;
  document.getElementById("log").appendChild(item);
};
