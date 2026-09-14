/**
 * The mark a sent task wears: a rounded square with three coloured dots and
 * three lines, the shape a person knows from the Reminders icon, drawn small
 * enough to sit at the end of a line of text.
 *
 * The square and the lines take the text colour, so the mark belongs to
 * whatever theme it lands in; the dots keep the three colours the eye reads
 * as "a reminders list".
 */
const SVG_NS = "http://www.w3.org/2000/svg";

const DOT_COLOURS = ["#ff453a", "#ff9f0a", "#0a84ff"];
const ROWS = [7.5, 12, 16.5];

export function renderReminderIcon(parent: HTMLElement): SVGSVGElement {
  const doc = parent.ownerDocument;
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");

  const square = doc.createElementNS(SVG_NS, "rect");
  square.setAttribute("x", "2");
  square.setAttribute("y", "2");
  square.setAttribute("width", "20");
  square.setAttribute("height", "20");
  square.setAttribute("rx", "5");
  square.setAttribute("fill", "currentColor");
  square.setAttribute("opacity", "0.14");
  svg.appendChild(square);

  ROWS.forEach((y, index) => {
    const dot = doc.createElementNS(SVG_NS, "circle");
    dot.setAttribute("cx", "7.5");
    dot.setAttribute("cy", String(y));
    dot.setAttribute("r", "1.9");
    dot.setAttribute("fill", DOT_COLOURS[index] ?? "currentColor");
    svg.appendChild(dot);

    const line = doc.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", "11.5");
    line.setAttribute("x2", "18");
    line.setAttribute("y1", String(y));
    line.setAttribute("y2", String(y));
    line.setAttribute("stroke", "currentColor");
    line.setAttribute("stroke-width", "1.8");
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("opacity", "0.6");
    svg.appendChild(line);
  });

  parent.appendChild(svg);
  return svg;
}
