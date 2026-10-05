/**
 * Whether an SVG is a picture and nothing more.
 *
 * An SVG served from the site's own domain and opened on its own is a
 * document: whatever script it carries runs with the site's cookies and
 * storage. The check that stood here was a handful of regular expressions
 * over the text, and XML has too many ways to say one thing for that to hold:
 * `<s:script>` under a prefix bound to the SVG namespace is a script, so is
 * `<h:script>` under XHTML's, and `&#106;avascript:` is `javascript:` once the
 * parser has read it. None of them matched.
 *
 * So the text is read the way an XML parser reads it — tags, attributes,
 * character references, comments, CDATA — and held to an allow-list: the
 * elements a drawing is made of, the attributes they take, references only
 * into the document itself (or, for an uploaded drawing, to pictures and fonts
 * it carries as `data:` URIs). Anything not on the list is refused rather
 * than reasoned about, which is what keeps a namespace trick or a new
 * attribute from being the next bypass.
 *
 * Pure, and linear in the length of the text.
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

/** What a drawing is made of. Case matters: this is XML, and `<Script>` is
 *  not on the list either. */
const ELEMENTS = new Set([
  "svg",
  "g",
  "defs",
  "symbol",
  "use",
  "switch",
  "a",
  "title",
  "desc",
  "metadata",
  "style",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "textPath",
  "image",
  "linearGradient",
  "radialGradient",
  "stop",
  "pattern",
  "clipPath",
  "mask",
  "marker",
  "view",
  "filter",
  "feBlend",
  "feColorMatrix",
  "feComponentTransfer",
  "feComposite",
  "feConvolveMatrix",
  "feDiffuseLighting",
  "feDisplacementMap",
  "feDistantLight",
  "feDropShadow",
  "feFlood",
  "feFuncA",
  "feFuncB",
  "feFuncG",
  "feFuncR",
  "feGaussianBlur",
  "feImage",
  "feMerge",
  "feMergeNode",
  "feMorphology",
  "feOffset",
  "fePointLight",
  "feSpecularLighting",
  "feSpotLight",
  "feTile",
  "feTurbulence",
  "animate",
  "animateMotion",
  "animateTransform",
  "set",
  "mpath"
]);

/** Elements whose `attributeName` names what an animation changes. */
const ANIMATIONS = new Set(["animate", "animateMotion", "animateTransform", "set"]);

/** Elements that may show a picture the drawing carries as a `data:` URI. */
const PICTURE_ELEMENTS = new Set(["image", "feImage"]);

/**
 * The attributes those elements take: geometry, presentation, gradients,
 * filters, text, animation timing, and what the exporters write on the root
 * (draw.io's `content`, Mermaid's ARIA roles). `href` and `style` are here
 * and get rules of their own below; every value is checked for references
 * whatever its name.
 */
const ATTRIBUTES = new Set(
  [
    // Core and structure.
    "id class style lang tabindex role version baseProfile width height x y viewBox",
    "preserveAspectRatio zoomAndPan transform href content focusable target",
    "requiredFeatures requiredExtensions systemLanguage externalResourcesRequired",
    // Shapes.
    "x1 y1 x2 y2 cx cy r rx ry fx fy fr d points pathLength",
    // Gradients, patterns, clipping, masks, markers.
    "gradientUnits gradientTransform spreadMethod offset stop-color stop-opacity",
    "patternUnits patternContentUnits patternTransform clipPathUnits maskUnits",
    "maskContentUnits clip-path clip-rule mask markerWidth markerHeight markerUnits",
    "refX refY orient marker-start marker-mid marker-end",
    // Text.
    "dx dy rotate textLength lengthAdjust text-anchor dominant-baseline",
    "alignment-baseline baseline-shift font font-family font-size font-size-adjust",
    "font-stretch font-style font-variant font-weight letter-spacing word-spacing",
    "writing-mode direction unicode-bidi text-decoration text-rendering startOffset",
    "method spacing side kerning white-space glyph-orientation-horizontal",
    "glyph-orientation-vertical",
    // Presentation.
    "fill fill-opacity fill-rule stroke stroke-dasharray stroke-dashoffset",
    "stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width",
    "opacity color color-interpolation color-interpolation-filters color-rendering",
    "display visibility overflow clip filter flood-color flood-opacity lighting-color",
    "image-rendering shape-rendering paint-order vector-effect pointer-events cursor",
    "enable-background mix-blend-mode isolation transform-origin transform-box",
    // Filters.
    "filterUnits primitiveUnits in in2 result stdDeviation mode type values operator",
    "k1 k2 k3 k4 order kernelMatrix divisor bias targetX targetY edgeMode",
    "kernelUnitLength preserveAlpha surfaceScale diffuseConstant specularConstant",
    "specularExponent scale xChannelSelector yChannelSelector radius baseFrequency",
    "numOctaves seed stitchTiles azimuth elevation pointsAtX pointsAtY pointsAtZ",
    "limitingConeAngle z tableValues slope intercept amplitude exponent",
    // Animation.
    "attributeName attributeType begin dur end min max restart repeatCount repeatDur",
    "calcMode keyTimes keySplines keyPoints from to by additive accumulate path"
  ]
    .join(" ")
    .split(" ")
);

/** Prefixed attributes with a meaning of their own; every other prefix is refused. */
const PREFIXED_ATTRIBUTES = new Set(["xlink:href", "xlink:title", "xml:space", "xml:lang"]);

/** The five entities XML defines without a DTD; any other name needs one. */
const NAMED_ENTITIES = new Map([
  ["lt", "<"],
  ["gt", ">"],
  ["amp", "&"],
  ["quot", '"'],
  ["apos", "'"]
]);

/** A picture or font a drawing may carry inside itself. */
const EMBEDDED_PICTURE = /^data:image\/(?:png|jpeg|jpg|gif|webp|avif|svg\+xml)[;,]/i;
const EMBEDDED_RESOURCE =
  /^data:(?:image\/(?:png|jpeg|jpg|gif|webp|avif|svg\+xml)|font\/[a-z0-9.+-]+|application\/(?:font-[a-z0-9.+-]+|x-font-[a-z0-9.+-]+|vnd\.ms-fontobject))[;,]/i;

/** Schemes that run something when followed, anywhere in any value. */
const ACTIVE_SCHEME = /(?:java|vb|live)script:|data:text\/html|data:application\/xhtml/;

const NAME = /[A-Za-z_][A-Za-z0-9._-]*(?::[A-Za-z_][A-Za-z0-9._-]*)?/y;
const ATTRIBUTE_NAME = /[A-Za-z_][A-Za-z0-9._-]*(?::[A-Za-z_][A-Za-z0-9._-]*)?/y;
const SPACE = /[ \t\r\n]*/y;

class Refusal extends Error {}

/**
 * `{ ok: true }`, or `{ ok: false, reason }` naming what was refused, for the
 * log. `embedded` is an uploaded drawing, which may carry its own pictures and
 * fonts as `data:` URIs; a tab icon may not.
 */
export function checkSvg(text, { embedded = false } = {}) {
  if (typeof text !== "string") return { ok: false, reason: "not text" };
  try {
    scan(text.startsWith("﻿") ? text.slice(1) : text, embedded);
    return { ok: true };
  } catch (err) {
    if (err instanceof Refusal) return { ok: false, reason: err.message };
    throw err;
  }
}

/** Whether an SVG passes `checkSvg`. */
export function isSafeSvg(text, options = {}) {
  return checkSvg(text, options).ok;
}

function scan(s, embedded) {
  const stack = [];
  // A stylesheet is judged whole, when its element closes: split by a
  // comment or a CDATA section, `@imp` and `ort` are one `@import` to the
  // parser that joins them.
  let sheet = null;
  let seenAnything = false;
  let rootDone = false;
  let doctype = false;
  let i = 0;

  while (i < s.length) {
    if (s[i] !== "<") {
      const end = s.indexOf("<", i);
      const stop = end === -1 ? s.length : end;
      const value = decode(s.slice(i, stop));
      if (stack.length === 0 && value.trim() !== "") throw new Refusal("text outside the root");
      if (sheet !== null) sheet += value;
      i = stop;
      continue;
    }

    if (s.startsWith("<?", i)) {
      const end = s.indexOf("?>", i + 2);
      if (end === -1) throw new Refusal("unterminated processing instruction");
      // The declaration only, and only first: any other instruction is one a
      // reader may act on, and a stylesheet instruction loads from elsewhere.
      if (seenAnything || !/^<\?xml[ \t\r\n]/.test(s.slice(i, end + 2))) {
        throw new Refusal("processing instruction");
      }
      seenAnything = true;
      i = end + 2;
      continue;
    }

    if (s.startsWith("<!--", i)) {
      const end = s.indexOf("-->", i + 4);
      if (end === -1) throw new Refusal("unterminated comment");
      const body = s.slice(i + 4, end);
      // An HTML parser ends `<!-->` at once and reads on; XML does not. Text
      // that is a comment to one and markup to the other is refused, in case
      // a host serves the file as HTML.
      if (body.includes("--") || /[<>]/.test(body)) throw new Refusal("comment with markup");
      seenAnything = true;
      i = end + 3;
      continue;
    }

    if (s.startsWith("<![CDATA[", i)) {
      const end = s.indexOf("]]>", i + 9);
      if (end === -1) throw new Refusal("unterminated CDATA");
      // Only a stylesheet has a reason to be written that way.
      if (sheet === null) throw new Refusal("CDATA outside a style");
      sheet += s.slice(i + 9, end);
      i = end + 3;
      continue;
    }

    if (s.startsWith("<!DOCTYPE", i)) {
      if (doctype || stack.length > 0 || rootDone) throw new Refusal("misplaced DOCTYPE");
      i = skipDoctype(s, i + 9);
      doctype = true;
      seenAnything = true;
      continue;
    }

    if (s.startsWith("<!", i)) throw new Refusal("markup declaration");

    if (s.startsWith("</", i)) {
      NAME.lastIndex = i + 2;
      const match = NAME.exec(s);
      if (!match) throw new Refusal("malformed end tag");
      SPACE.lastIndex = NAME.lastIndex;
      SPACE.exec(s);
      if (s[SPACE.lastIndex] !== ">") throw new Refusal("malformed end tag");
      if (stack.pop() !== match[0]) throw new Refusal("mismatched end tag");
      if (match[0] === "style") {
        css(sheet, embedded);
        sheet = null;
      }
      if (stack.length === 0) rootDone = true;
      i = SPACE.lastIndex + 1;
      continue;
    }

    const tag = startTag(s, i);
    if (sheet !== null) throw new Refusal("element inside a style");
    if (rootDone) throw new Refusal("content after the root");
    if (stack.length === 0 && tag.name !== "svg") throw new Refusal("root is not <svg>");
    element(tag, embedded);
    seenAnything = true;
    if (tag.selfClosing) {
      if (stack.length === 0) rootDone = true;
    } else {
      stack.push(tag.name);
      if (tag.name === "style") sheet = "";
    }
    i = tag.end;
  }

  if (!rootDone) throw new Refusal(stack.length > 0 ? "unclosed element" : "no <svg> root");
}

/**
 * A DOCTYPE that only names the SVG DTD, as older exporters write it. An
 * internal subset is where entities are declared, and an entity is a way to
 * spell anything at all, so `[` is refused. Quoted parts may hold `>`.
 */
function skipDoctype(s, i) {
  let quote = null;
  for (let at = i; at < s.length; at += 1) {
    const c = s[at];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === "[") {
      throw new Refusal("DOCTYPE with an internal subset");
    } else if (c === ">") {
      return at + 1;
    }
  }
  throw new Refusal("unterminated DOCTYPE");
}

function startTag(s, i) {
  NAME.lastIndex = i + 1;
  const match = NAME.exec(s);
  if (!match) throw new Refusal("malformed tag");
  const name = match[0];
  const attributes = new Map();
  let at = NAME.lastIndex;

  for (;;) {
    SPACE.lastIndex = at;
    const gap = SPACE.exec(s)[0].length;
    at = SPACE.lastIndex;
    if (s.startsWith("/>", at)) return { name, attributes, selfClosing: true, end: at + 2 };
    if (s[at] === ">") return { name, attributes, selfClosing: false, end: at + 1 };
    if (gap === 0) throw new Refusal(`malformed attributes on <${name}>`);

    ATTRIBUTE_NAME.lastIndex = at;
    const attribute = ATTRIBUTE_NAME.exec(s);
    if (!attribute) throw new Refusal(`malformed attribute on <${name}>`);
    at = ATTRIBUTE_NAME.lastIndex;
    SPACE.lastIndex = at;
    SPACE.exec(s);
    at = SPACE.lastIndex;
    if (s[at] !== "=") throw new Refusal(`attribute without a value on <${name}>`);
    SPACE.lastIndex = at + 1;
    SPACE.exec(s);
    at = SPACE.lastIndex;
    const quote = s[at];
    if (quote !== '"' && quote !== "'") throw new Refusal(`unquoted attribute on <${name}>`);
    const close = s.indexOf(quote, at + 1);
    if (close === -1) throw new Refusal(`unterminated attribute on <${name}>`);
    const raw = s.slice(at + 1, close);
    if (raw.includes("<")) throw new Refusal(`"<" in an attribute on <${name}>`);
    // Two of one name is not XML, and two parsers may each keep a different one.
    if (attributes.has(attribute[0])) throw new Refusal(`duplicate ${attribute[0]}`);
    attributes.set(attribute[0], decode(raw));
    at = close + 1;
  }
}

function element({ name, attributes }, embedded) {
  if (name.includes(":")) throw new Refusal(`prefixed element <${name}>`);
  if (!ELEMENTS.has(name)) throw new Refusal(`element <${name}>`);

  for (const [attribute, value] of attributes) {
    if (attribute === "xmlns") {
      if (value !== SVG_NS) throw new Refusal(`default namespace ${value}`);
      continue;
    }
    if (attribute.startsWith("xmlns:")) {
      if (attribute !== "xmlns:xlink" || value !== XLINK_NS) {
        throw new Refusal(`namespace binding ${attribute}`);
      }
      continue;
    }
    if (/^on/i.test(attribute)) throw new Refusal(`event handler ${attribute}`);
    if (attribute.includes(":")) {
      if (!PREFIXED_ATTRIBUTES.has(attribute)) throw new Refusal(`attribute ${attribute}`);
    } else if (!ATTRIBUTES.has(attribute) && !/^(?:data|aria)-[a-z0-9_.-]+$/i.test(attribute)) {
      throw new Refusal(`attribute ${attribute} on <${name}>`);
    }

    // A URL parser skips tabs and line breaks inside a scheme, so the check
    // does too; matching control characters is the point here.
    // eslint-disable-next-line no-control-regex
    const compact = value.replace(/[\s\u0000-\u001f\u007f]+/g, "").toLowerCase();
    if (ACTIVE_SCHEME.test(compact)) throw new Refusal(`active URL in ${attribute}`);

    if (attribute === "href" || attribute === "xlink:href") {
      reference(value, name, embedded);
    } else if (attribute === "style" || /url\(/i.test(value)) {
      css(value, embedded);
    }

    if (attribute === "attributeName" && ANIMATIONS.has(name)) {
      const local = value
        .trim()
        .replace(/^[^:]*:/, "")
        .toLowerCase();
      if (local === "href" || local.startsWith("on")) {
        throw new Refusal(`animation of ${value}`);
      }
    }
  }
}

/** A reference into the document, or a picture it carries itself. */
function reference(value, element, embedded) {
  const target = value.trim();
  if (target.startsWith("#")) return;
  if (embedded && PICTURE_ELEMENTS.has(element) && EMBEDDED_PICTURE.test(target)) return;
  throw new Refusal(`reference out of the document from <${element}>`);
}

/**
 * A stylesheet, or a style attribute: no import, no escape that could spell
 * `url` without the letters, and every `url(…)` pointing into the document or
 * at a resource it carries.
 */
function css(text, embedded) {
  const comments = /\/\*[\s\S]*?\*\//g;
  const plain = text.replace(comments, " ");
  if (plain.includes("/*")) throw new Refusal("unterminated CSS comment");
  if (/[\\<]/.test(plain)) throw new Refusal("CSS escape or markup");
  if (/@import/i.test(plain)) throw new Refusal("CSS @import");
  if (/expression\s*\(|-moz-binding|behavior\s*:/i.test(plain)) {
    throw new Refusal("CSS that runs code");
  }
  // These take a bare string as an address, so the rule for url() would
  // never see what they load.
  if (/(?:image-set|image|src)\s*\(/i.test(plain)) throw new Refusal("CSS image function");

  const urls = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^"')\s]*))\s*\)/gi;
  const total = (plain.match(/url\(/gi) ?? []).length;
  let seen = 0;
  for (const match of plain.matchAll(urls)) {
    seen += 1;
    const target = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (target.startsWith("#")) continue;
    if (embedded && EMBEDDED_RESOURCE.test(target)) continue;
    throw new Refusal("CSS url() out of the document");
  }
  if (seen !== total) throw new Refusal("unreadable CSS url()");
}

/**
 * Character references read as the parser reads them, so a value is judged by
 * what it says rather than by how it was spelled. A named one other than the
 * five XML knows would need a DTD, and is refused.
 */
function decode(raw) {
  return raw.replace(/&([^;&]*);?/g, (whole, body) => {
    if (!whole.endsWith(";")) throw new Refusal("bare &");
    if (NAMED_ENTITIES.has(body)) return NAMED_ENTITIES.get(body);
    const numeric = /^#(?:x([0-9a-fA-F]{1,6})|([0-9]{1,7}))$/.exec(body);
    if (!numeric) throw new Refusal(`entity &${body};`);
    const code = numeric[1] !== undefined ? Number.parseInt(numeric[1], 16) : Number(numeric[2]);
    if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
      throw new Refusal("invalid character reference");
    }
    return String.fromCodePoint(code);
  });
}
