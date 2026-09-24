/**
 * The compiler's own thread.
 *
 * Typesetting a document is one long synchronous call into WebAssembly. On the
 * main thread that is a frozen interface for as long as it takes — half a
 * second on a laptop, longer on a phone, and exactly the moment a person is
 * watching to see whether anything happened. So it runs here instead.
 *
 * Written as source text rather than as a module because a plugin has no URL a
 * worker can be started from: the text becomes a blob, and the blob becomes
 * the worker. Everything it needs arrives in messages, and it holds nothing
 * between prints but the instantiated module and the standard fonts, which
 * are the expensive parts.
 */
export const WORKER_SOURCE = String.raw`
let typst = null;
// The standard faces, sent once with the module rather than with every print.
let baseFonts = [];

self.onmessage = async (event) => {
  const { id, kind, payload } = event.data ?? {};
  try {
    if (kind === "init") {
      // The loader is an ES module; a worker can only import one from a URL,
      // so its text becomes one for as long as the import takes.
      const url = URL.createObjectURL(new Blob([payload.loader], { type: "text/javascript" }));
      try {
        typst = await import(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      // A compiled module rather than bytes: it crossed the thread boundary
      // without copying twenty-eight megabytes, and instantiating it is what
      // is left to do.
      await typst.default({ module_or_path: payload.module });
      baseFonts = payload.fonts ?? [];
      self.postMessage({ id, ok: true });
      return;
    }

    if (kind === "compile") {
      if (!typst) throw new Error("the compiler was not loaded");

      const builder = new typst.TypstCompilerBuilder();
      // No access model: the compiler may read the files handed to it below
      // and nothing else. There is no file system here to reach anyway, and
      // saying so is cheaper than relying on that.
      await builder.set_dummy_access_model();
      // The template's own faces beside the standard ones: Typst chooses by
      // family, so a template that names its font gets it, and one that names
      // none is set in the standard face rather than in nothing.
      for (const font of baseFonts) await builder.add_raw_font(font);
      for (const font of payload.fonts) await builder.add_raw_font(font);

      const compiler = await builder.build();
      for (const file of payload.sources) compiler.add_source(file.path, file.text);
      for (const file of payload.binaries) compiler.map_shadow(file.path, file.bytes);

      const result = await compiler.compile(payload.main, undefined, "pdf", 2);
      const pdf = result instanceof Uint8Array ? result : result?.result;
      if (pdf instanceof Uint8Array) {
        self.postMessage({ id, ok: true, pdf }, [pdf.buffer]);
      } else {
        self.postMessage({ id, ok: true, diagnostics: result?.diagnostics ?? [] });
      }
      return;
    }

    throw new Error("unknown request: " + kind);
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error && error.message ? error.message : error) });
  }
};
`;
