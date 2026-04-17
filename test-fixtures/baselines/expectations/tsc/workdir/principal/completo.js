// 2. Enums: Algo que no existe en JS nativo
var UserRole;
(function (UserRole) {
    UserRole["Admin"] = "ADMIN";
    UserRole["Editor"] = "EDITOR";
    UserRole["Viewer"] = "VIEWER";
})(UserRole || (UserRole = {}));
// 3. Clases con modificadores de acceso (private/public/protected) y Shorthand
class UIHandler {
    element;
    // El constructor inicializa la propiedad 'element' automáticamente
    constructor(element) {
        this.element = element;
    }
    render(content, color = 'black') {
        this.element.textContent = content;
        this.element.style.color = color;
    }
    // Método que usa tipos de utilidad de TS
    updateConfig(config) {
        console.log(`Actualizando usuario con: ${config.name}`);
    }
}
// 4. Lógica de manipulación del DOM con Type Casting (Aserción)
const body = document.querySelector('body');
const mainTitle = document.createElement('h1');
body.appendChild(mainTitle);
// 5. Instanciación con Generics
const headerManager = new UIHandler(mainTitle);
const currentUser = {
    id: "USR-123",
    name: 'Juan Pérez',
    role: UserRole.Admin
};
// 6. Funciones con tipado estricto y Template Strings
/**
 * Inicializa la aplicación
 * @param user Datos del perfil del usuario
 * @param manager Instancia del controlador de UI
 */
function initApp(user, manager) {
    const welcomeMsg = `Bienvenido, ${user.name} (${user.role})`;
    manager.render(welcomeMsg, 'blue');
    // Ejemplo de Type Guard sencillo
    if (user.age && user.age >= 18) {
        console.log("Acceso concedido a funciones Pro");
    }
}
// Ejecución
initApp(currentUser, headerManager);
// 7. Exportación ES6
export const VERSION = 2.0;
