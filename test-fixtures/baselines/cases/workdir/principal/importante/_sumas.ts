import { utils1, utils2 } from "./_base.ts";
export function suma(a: number, b: number): number {
    const extra = parseInt(utils1());
    return a + b + extra;
}
export function resta(a: number, b: number): number {
    let extra = parseInt(utils1());
    utils2().then(r => extra = r);
    return a - b + extra;
}