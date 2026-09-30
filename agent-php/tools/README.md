# Static analysis tools

This project is often edited on machines with no PHP binary, so these Node
scripts stand in for `php -l` and a quick sanity pass.

```bash
cd tools && npm install     # once
cd ..

node tools/phplint.mjs   app bin public   # parse every .php file
node tools/phpcheck.mjs  app bin public   # Class::method()/new/$this-> resolution + arity
node tools/routecheck.mjs                 # every UI API call has a matching route
node tools/routecheck.mjs --unused        # ...and which routes the UI never calls
```

`routecheck.mjs` exits non-zero when a front-end call would 404 at runtime,
so it is worth running after touching `app/Routes.php` or `public/*.html`.

They are a safety net, not a substitute for running the app: they cannot catch
runtime, type or permission errors.
