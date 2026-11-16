import type { Locator } from "@playwright/test";

/**
 * The pieces of text inside an element that are drawn outside its box (cut off, wrapped past an edge or pushed
 * out), as a list of the words. An empty list means every word fits. It measures each text node's own rectangle, so
 * an inline element, whose scrollWidth is always 0, cannot pass without being looked at.
 */
export function textOutside(locator: Locator): Promise<string[]> {
  return locator.evaluate((root) => {
    const frame = root.getBoundingClientRect();
    const outside: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.textContent ?? "").trim();
      if (!text) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width === 0) continue;
        if (rect.left < frame.left - 0.5 || rect.right > frame.right + 0.5)
          outside.push(text);
      }
    }
    return outside;
  });
}

/** How many lines the text inside an element is drawn on (a hint or a title is meant to stay on one). */
export function lineCount(locator: Locator): Promise<number> {
  return locator.evaluate((root) => {
    const tops = new Set<number>();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!(node.textContent ?? "").trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of Array.from(range.getClientRects()))
        if (rect.width > 0) tops.add(Math.round(rect.top / 4));
    }
    return tops.size;
  });
}
