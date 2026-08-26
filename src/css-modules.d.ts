/** CSS Modules default exports (hashed class maps injected at bundle run). */
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}
