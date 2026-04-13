interface ILoquesea2 {
    nombre: string;
    edad: number;
}
const body = document.querySelector('body');
const h1 = document.createElement('h1');
h1.textContent = 'Hola Mundo';
body?.appendChild(h1);
/**
 * ejemplo de que ace
 * @param el 
 * @param op 
 */
function test(el: HTMLElement,op: ILoquesea2) {
    el.textContent = `Hola ${op.nombre}`;
    el.style.color = 'red';
}