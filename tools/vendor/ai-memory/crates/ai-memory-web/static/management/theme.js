(function () {
  var key = "ai-memory-management-theme";
  var theme = "system";
  try { theme = localStorage.getItem(key) || "system"; } catch (_) {}
  if (theme !== "light" && theme !== "dark") theme = "system";
  document.documentElement.dataset.theme = theme;
  document.addEventListener("DOMContentLoaded", function () {
    var buttons = document.querySelectorAll("button[data-theme]");
    function select(value) {
      document.documentElement.dataset.theme = value;
      buttons.forEach(function (button) { button.setAttribute("aria-pressed", String(button.dataset.theme === value)); });
    }
    select(theme);
    buttons.forEach(function (button) { button.addEventListener("click", function () {
      var value = button.dataset.theme;
      select(value);
      try { if (value === "system") localStorage.removeItem(key); else localStorage.setItem(key, value); } catch (_) {}
    }); });
    document.querySelectorAll('input[autocomplete="new-password"]').forEach(function (input) {
      input.addEventListener("input", function () {
        input.setCustomValidity(Array.from(input.value).length < input.minLength ? "Use at least " + input.minLength + " characters." : "");
      });
    });
    var issued = document.getElementById("issued-secret");
    if (issued) history.replaceState(null, "", issued.getAttribute("data-return"));
    window.addEventListener("pagehide", function () {
      var secret = document.getElementById("issued-secret");
      if (secret) secret.textContent = "";
    });
    var endpoint = document.getElementById("mcp-endpoint");
    if (endpoint) endpoint.textContent = new URL(endpoint.textContent, location.origin).href;
  });
})();
