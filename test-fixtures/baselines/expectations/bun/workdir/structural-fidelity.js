// cases/workdir/structural-fidelity.ts
var body = document.querySelector("body");
var h1 = document.createElement("h1");
h1.textContent = "Hola Mundo";
body?.appendChild(h1);
function test(el, op) {
  const x = 123;
  el.textContent = `Hola ${op.nombre}`;
  el.style.color = "red";
}
var config = {
  nombre: "juan",
  edad: 15
};
test(body, config);
var hola = 1;
export {
  hola
};
