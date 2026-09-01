import { render } from './utils';

// Renders a go.mod for the generated package, pinning the Go dependencies the
// generated code needs (goMod.njk is the single source of those versions).
// Run `go mod tidy` afterwards to resolve the indirect requirements.
export function renderGoMod(moduleName: string): string {
    return render('goMod.njk', { moduleName });
}
