interface ILoquesea2 {
    nombre: string;
    edad: number;
}
//declare function test(el: HTMLElement,op: ILoquesea2);
const body:HTMLBodyElement = document.querySelector('body')!;
const h1 = document.createElement('h1');
h1.textContent = 'Hola Mundo';
body?.appendChild(h1);
/**
 * ejemplo de xsss
 */
function test(el: HTMLElement,op: ILoquesea2) {
    el.textContent = `Hola ${op.nombre}`;
    el.style.color = 'red';
}
const config :ILoquesea2 = {
    nombre:'juan',
    edad:15
};
test(body,config)