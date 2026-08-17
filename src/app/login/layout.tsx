// Inloggningssidan ska inte ha appens navigering — man är ju inte inne än.
// En egen layout under /login ersätter innehållet men behåller rot-layoutens
// <html>/<body> och globala stilar.
export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
