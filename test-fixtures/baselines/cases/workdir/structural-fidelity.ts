interface ILoquesea2 {
    nombre: string;
    edad: number;
}

const body: HTMLBodyElement = document.querySelector('body')!;
const h1 = document.createElement('h1');
h1.textContent = 'Hola Mundo';
body?.appendChild(h1);

/**
 * s
 * @param {HTMLElement} el 
 * @param {ILoquesea2} op 
 */
function test(el: HTMLElement, op: ILoquesea2) {
    const x = 123;
    el.textContent = `Hola ${op.nombre}`;
    el.style.color = 'red';
}

const config: ILoquesea2 = {
    nombre: 'juan',
    edad: 15
};

test(body, config);

/** archivoss */
export const hola: number = 1;
