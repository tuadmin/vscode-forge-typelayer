// 1. Tipos avanzados: Interfaces con propiedades opcionales y solo lectura
interface UserProfile {
    readonly id: string | number; // Union types
    name: string;
    age?: number;               // Propiedad opcional
    role: UserRole;             // Uso de Enum
}

// 2. Enums: Algo que no existe en JS nativo
enum UserRole {
    Admin = 'ADMIN',
    Editor = 'EDITOR',
    Viewer = 'VIEWER'
}

// 3. Clases con modificadores de acceso (private/public/protected) y Shorthand
class UIHandler<T extends HTMLElement> {
    // El constructor inicializa la propiedad 'element' automáticamente
    constructor(private element: T) { }

    public render(content: string, color: string = 'black'): void {
        this.element.textContent = content;
        this.element.style.color = color;
    }

    // Método que usa tipos de utilidad de TS
    public updateConfig(config: Partial<UserProfile>): void {
        console.log(`Actualizando usuario con: ${config.name}`);
    }
}

// 4. Lógica de manipulación del DOM con Type Casting (Aserción)
const body = document.querySelector('body') as HTMLBodyElement;
const mainTitle = document.createElement('h1');
body.appendChild(mainTitle);

// 5. Instanciación con Generics
const headerManager = new UIHandler<HTMLHeadingElement>(mainTitle);

const currentUser: UserProfile = {
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
function initApp(user: UserProfile, manager: UIHandler<HTMLHeadingElement>): void {
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
export const VERSION: number = 2.0;
export const VERSION_2: number = 100;
export type { UserProfile }; // Exportar solo el tipo
