import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Renders a server-compatible component to HTML and parses it, so tests can
 * assert on semantics (roles, labels, attributes) without a browser or jsdom.
 */
export function render(element: ReactElement): Document {
  const html = renderToStaticMarkup(element);
  // Node has no DOMParser; a tiny wrapper keeps tests readable instead.
  return parseHtml(html);
}

type Document = {
  html: string;
  /** All opening tags matching `tag` with their attributes. */
  elements(tag: string): Array<Record<string, string>>;
  text(): string;
};

function parseHtml(html: string): Document {
  return {
    html,
    elements(tag) {
      const pattern = new RegExp(`<${tag}(\\s[^>]*)?>`, "g");
      return [...html.matchAll(pattern)].map((match) =>
        Object.fromEntries(
          [...(match[1] ?? "").matchAll(/([\w:-]+)(?:="([^"]*)")?/g)].map(
            ([, name, value]) => [name!, value ?? ""],
          ),
        ),
      );
    },
    text() {
      return html
        .replace(/<[^>]+>/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/\s+/g, " ")
        .trim();
    },
  };
}
