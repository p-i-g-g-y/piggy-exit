export const byId = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const element = document.getElementById(id)
  if (!element) throw new Error(`#${id} is missing`)
  return element as T
}

/** Shows `line` in `element`, or hides it for null. */
export const say = (element: HTMLElement, line: string | null): void => {
  element.textContent = line ?? ""
  element.hidden = line === null
}
