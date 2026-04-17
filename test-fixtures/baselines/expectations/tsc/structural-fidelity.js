const body = document.querySelector('body');
const h1 = document.createElement('h1');
h1.textContent = 'Hola Mundo';
body?.appendChild(h1);
/**
 * s
 * @param {HTMLElement} el
 * @param {ILoquesea2} op
 */
function test(el, op) {
    const x = 123;
    el.textContent = `Hola ${op.nombre}`;
    el.style.color = 'red';
}
const config = {
    nombre: 'juan',
    edad: 15
};
test(body, config);
/** archivoss */
export const hola = 1;
