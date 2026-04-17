import { plugin } from "bun";
import { relative, isAbsolute, dirname } from "node:path";
//deberia ser la ruta del worskace o carpeta q abrio vscode
// Normalizar baseDir (reemplaza backslashes por forward slashes para consistencia)
const baseDir = import.meta.dir.replace(/\\/g, '/');
const smartBundlePlugin = {
    name: "smart-bundle-plugin",
    setup(build: any) {
        build.onResolve({ filter: /.*/ }, (args: any) => {
            // Ignorar el punto de entrada inicial
            if (!args.importer) return;

            const isTs = args.path.endsWith(".ts");
            const fileName = args.path.split("/").pop() || "";
            const startsWithUnderscore = fileName.startsWith("_");

            // Verificar si es un archivo "hijo o hermano" (no empieza con ..)
            // relative da la ruta desde el que importa hacia el importado
            const relPath = args.path.startsWith(".") ? args.path : "";
            const isParent = relPath.startsWith("..");

            // Lógica: Solo bundlear si es TS Y empieza con _ Y NO es un nivel superior
            const shouldBundle = isTs && startsWithUnderscore && !isParent;

            if (!shouldBundle) {
                let realPathFile = args.path;
                if (args.path.endsWith(".ts")) {
                    const path = realPathFile;
                    const lastSlash = path.lastIndexOf("/");

                    const dir = lastSlash >= 0 ? path.slice(0, lastSlash + 1) : "";
                    const file = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;

                    const fixedFile = file.endsWith(".ts")
                        ? file.slice(0, -3) + ".js"
                        : file;
                    realPathFile = dir + fixedFile;
                }
                return {
                    path: realPathFile,
                    external: true,
                };
            }

            // Si pasa el filtro, Bun lo bundlea normalmente (retornando undefined)
            return undefined;
        });
    },
};

// await Bun.build({
//     //entrypoints: ["./cases/workdir/principal/completo.source.ts"],
//     entrypoints: {
//         "principal/completo": `${baseDir}/cases/workdir/principal/completo.source.ts`,
//         "structural-fidelity": `${baseDir}/cases/workdir/structural-fidelity.ts`
//     },
//     //outdir: "./expectations/bun/workdir/principal/",
//     outdir: `${baseDir}/expectations/bun/workdir/`,
//     target: "node",
//     format: "esm",
//     plugins: [smartBundlePlugin],
// });


const entries = {
    "principal/completo": `${baseDir}/cases/workdir/principal/completo.source.ts`,
    "principal/importante": `${baseDir}/cases/workdir/principal/importante.source.ts`,
    "structural-fidelity": `${baseDir}/cases/workdir/structural-fidelity.ts`
};

for (const [name, path] of Object.entries(entries)) {
    await Bun.build({
        entrypoints: [path],
        outdir: `${baseDir}/expectations/bun/workdir/`,
        naming: `${name}.js`, // Aquí controlas el nombre final
        target: "node",
        format: "esm",
        minify: false,
        plugins: [smartBundlePlugin],
    });
}