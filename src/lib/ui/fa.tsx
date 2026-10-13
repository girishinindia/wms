import { config, type IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

/**
 * Font Awesome, the way this app uses it: the SVG icons from the npm
 * package (nothing loaded from a CDN), with the stylesheet imported once
 * by the root layout — so the icons never flash at full size while a
 * page loads.
 */
config.autoAddCss = false;

/** An icon sized and coloured by its className, like the hand-drawn ones. */
export function Fa({ icon, className, title }: { icon: IconDefinition; className?: string; title?: string }) {
  return <FontAwesomeIcon icon={icon} className={className} title={title} aria-hidden={title ? undefined : true} fixedWidth />;
}

/** A component with the same props as the hand-drawn icons (`className`). */
export const faIcon = (icon: IconDefinition) =>
  function FaIcon({ className }: { className?: string }) {
    return <Fa icon={icon} className={className} />;
  };
