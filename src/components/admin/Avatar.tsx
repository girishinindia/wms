import Image from "next/image";

/**
 * A person, at whatever size the surface needs.
 *
 * Falls back to initials rather than to a silhouette or a placeholder
 * file: a grey outline of a head is the same picture for everybody,
 * which is exactly the job an avatar is supposed to do differently, and
 * a placeholder image is a request that fails to say anything.
 *
 * `unoptimized` on purpose. The stored file is already a 512px WebP
 * produced by the cropper, so running it through the image optimiser
 * would spend transformation quota to arrive back where it started.
 */
export default function Avatar({
  name,
  photoUrl,
  size = 32,
  className = "",
}: {
  name: string;
  photoUrl?: string | null;
  /** Rendered edge in px — also the intrinsic size handed to next/image. */
  size?: number;
  className?: string;
}) {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join("") || "?";

  const shell = `relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full ${className}`;

  if (photoUrl) {
    return (
      <span className={shell} style={{ width: size, height: size }}>
        <Image
          src={photoUrl}
          alt={name}
          width={size}
          height={size}
          unoptimized
          className="h-full w-full object-cover"
        />
      </span>
    );
  }

  return (
    <span
      className={`${shell} border border-verdigris-300/20 bg-verdigris-400/12 font-semibold text-verdigris-200/80`}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) }}
      aria-label={name}
      title={name}
    >
      {initials}
    </span>
  );
}
