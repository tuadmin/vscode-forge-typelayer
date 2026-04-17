import { appVersion, tokenPublic } from "./../shared/constantes.js";
import { utils2 } from "./importante/_base.ts";
import { suma, resta } from "./importante/_sumas.ts";
import { tipoLiterales, tipoNumericos, Ejemplo } from "./ajeno.ts";
export async function consultarFetch(path: string, othersParam: unknown): Promise<HTMLElement> {
    let armarPath = globalThis.location.href;
    armarPath += path;
    armarPath += "?app=" + appVersion;
    armarPath += "&token=" + tokenPublic;
    const contenedor = document.createElement("div");
    contenedor.innerHTML = 'Cargando...';
    globalThis.setTimeout(async () => {
        contenedor.innerHTML = await fetch(armarPath).then(stream => stream.text());
    }, 10)

    return contenedor;
}

export async function prueba() {
    globalThis.console.log(await utils2());
    globalThis.console.log(await suma(4, 5));

    globalThis.console.log(await suma(4, 5) == 10);
    globalThis.console.error(await resta(4, 5) == 10);
}

/**
 * Descripcion de esta clase para fines lo que sea
 */
export class CustomElementTest extends HTMLElement {
    static TAG = 'custom-element';
    constructor() {
        super();
    }
}

globalThis.customElements.define(CustomElementTest.TAG, CustomElementTest);


//codigo inline
const objeto: Ejemplo = {
    prop1: 'segun contato',
    method1(_tipoNumericos, _tipoLiterales) {
        return tipoLiterales.SIMBOLO_RESTA == _tipoLiterales
            || tipoNumericos.TIPO3 != _tipoNumericos;
    },
}