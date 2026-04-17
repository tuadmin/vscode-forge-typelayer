

export enum tipoNumericos {
    tipo1 = 1,
    tipO2 = 2,
    TIPO3 = 3,
}

export enum tipoLiterales {
    SIMBOLO_SUMA = '+',
    SIMBOLO_RESTA = '-',
}
export interface Ejemplo {
    prop1: string;
    method1(tipoNumericos: tipoNumericos, tipoLiterales: tipoLiterales): unknown;
}