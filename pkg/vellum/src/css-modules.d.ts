declare module "*.module.css" {
  const classes: { readonly [key: string]: string };
  export default classes;
}

// Plain side-effect CSS imports (gothic skin, fontsource, app styles).
declare module "*.css";
