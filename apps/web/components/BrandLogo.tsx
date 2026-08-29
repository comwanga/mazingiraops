import Image from "next/image";
import Link from "next/link";
import { BRANDING } from "@/lib/branding";

interface BrandLogoProps {
  size?: number;
  priority?: boolean;
  href?: string;
}

export function BrandLogo({ size = 48, priority = false, href }: BrandLogoProps) {
  const image = (
    <Image
      src={BRANDING.logo}
      alt="Nairobi City County"
      width={size}
      height={size}
      priority={priority}
      className="brand-logo"
    />
  );

  if (href) {
    return (
      <Link href={href} className="brand-logo-link" aria-label="Home">
        {image}
      </Link>
    );
  }

  return image;
}

