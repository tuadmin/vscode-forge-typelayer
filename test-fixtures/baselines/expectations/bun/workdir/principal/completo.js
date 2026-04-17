// cases/workdir/principal/completo.source.ts
class UIHandler {
  element;
  #privateVar = 15;
  constructor(element) {
    this.element = element;
    this.#privateVar = 22;
  }
  obtener() {
    return this.#privateVar;
  }
  render(content, color = "black") {
    this.element.textContent = content;
    this.element.style.color = color;
  }
  updateConfig(config) {
    console.log(`Actualizando usuario con: ${config.name}`);
  }
}
var body = document.querySelector("body");
var mainTitle = document.createElement("h1");
body.appendChild(mainTitle);
var headerManager = new UIHandler(mainTitle);
var currentUser = {
  id: "USR-123",
  name: "Juan Pérez",
  role: "ADMIN" /* Admin */
};
function initApp(user, manager) {
  const welcomeMsg = `Bienvenido, ${user.name} (${user.role})`;
  manager.render(welcomeMsg, "blue");
  if (user.age && user.age >= 18) {
    console.log("Acceso concedido a funciones Pro");
  }
}
initApp(currentUser, headerManager);
var VERSION = 2;
var VERSION_NUMERIC = 102;
export {
  VERSION_NUMERIC,
  VERSION
};
