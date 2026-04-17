// cases/workdir/principal/importante.source.ts
import { appVersion, tokenPublic } from "./../shared/constantes.js";

// cases/workdir/principal/importante/_base.ts
function utils1() {
  return "ok";
}
async function utils2() {
  return 1;
}

// cases/workdir/principal/importante/_sumas.ts
function suma(a, b) {
  const extra = parseInt(utils1());
  return a + b + extra;
}
function resta(a, b) {
  let extra = parseInt(utils1());
  utils2().then((r) => extra = r);
  return a - b + extra;
}

// cases/workdir/principal/importante.source.ts
import { tipoLiterales, tipoNumericos } from "./ajeno.ts";
async function consultarFetch(path, othersParam) {
  let armarPath = globalThis.location.href;
  armarPath += path;
  armarPath += "?app=" + appVersion;
  armarPath += "&token=" + tokenPublic;
  const contenedor = document.createElement("div");
  contenedor.innerHTML = "Cargando...";
  globalThis.setTimeout(async () => {
    contenedor.innerHTML = await fetch(armarPath).then((stream) => stream.text());
  }, 10);
  return contenedor;
}
async function prueba() {
  globalThis.console.log(await utils2());
  globalThis.console.log(await suma(4, 5));
  globalThis.console.log(await suma(4, 5) == 10);
  globalThis.console.error(await resta(4, 5) == 10);
}

class CustomElementTest extends HTMLElement {
  static TAG = "custom-element";
  constructor() {
    super();
  }
}
globalThis.customElements.define(CustomElementTest.TAG, CustomElementTest);
export {
  prueba,
  consultarFetch,
  CustomElementTest
};
