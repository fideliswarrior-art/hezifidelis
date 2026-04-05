import React from "react";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Como o estilo (fundo cinza, centralização) já está sendo feito
  // individualmente nas páginas de login e register, este layout
  // serve apenas como uma "casca" invisível exigida pelo Next.js.
  return <>{children}</>;
}