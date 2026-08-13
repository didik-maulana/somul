import type React from "react";

interface AppIconProps {
  id: string;
  name: string;
}

export const AppIcon: React.FC<AppIconProps> = ({ id, name }) => (
  <img
    src={`/apps/${id}.svg`}
    alt={name}
    width={32}
    height={32}
    className="shrink-0 rounded-md"
  />
);
