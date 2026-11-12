import type { CSSProperties, SVGProps } from "react";

export type SvgIconName = string;

export type SvgIconProps = Omit<SVGProps<SVGSVGElement>, "color" | "height" | "name" | "width"> & {
  name: SvgIconName;
  size?: number | string;
  color?: CSSProperties["color"];
  title?: string;
};

export function SvgIcon({
  name,
  size = 16,
  color = "inherit",
  title,
  className,
  style,
  ...props
}: SvgIconProps) {
  const iconName = name.trim().replace(/\.svg$/i, "");
  const classes = ["svg-icon", className].filter(Boolean).join(" ");

  return (
    <svg
      {...props}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className={classes}
      fill="currentColor"
      focusable="false"
      height={size}
      role={title ? "img" : undefined}
      style={{
        color,
        display: "inline-block",
        flexShrink: 0,
        overflow: "hidden",
        verticalAlign: "middle",
        ...style,
      }}
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      {title ? <title>{title}</title> : null}
      <use href={`/icons/sprite.svg#icon-${iconName}`} />
    </svg>
  );
}
