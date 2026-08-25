# Reglas del Agente — bot-whatsapp-node

## Aprobación obligatoria antes de cambios

Antes de modificar, crear o eliminar cualquier archivo de código fuente,
el agente DEBE presentar un plan detallado que incluya:

1. **Qué se va a cambiar** — descripción del problema y solución propuesta
2. **Archivos afectados** — lista exacta de archivos que se modificarán, crearán o eliminarán
3. **Qué se quita** — código o lógica que se eliminará
4. **Qué se agrega** — código o lógica nueva
5. **Por qué** — justificación técnica de la decisión

El agente debe detenerse y esperar aprobación explícita del usuario antes de ejecutar cualquier cambio.

### Excepciones (no requieren aprobación previa)
- Corrección de errores de sintaxis triviales (typos)
- Agregar comentarios o documentación sin cambiar lógica
- Correr comandos de solo lectura (tsc --noEmit, cat, ls, etc.)

## Documentación oficial

Cuando necesites consultar la documentación oficial de OpenAI u otra librería, usa las herramientas de `context7`.

## Language policy (see `docs/adr/0002-language-policy.md`)

- **Public artifacts in English:** commit messages, README, `docs/*.md`, ADRs, GitHub issues,
  new code identifiers and comments. Never big-bang rename existing Spanish identifiers.
- **Private artifacts in Spanish:** internal notes under `docs/internal/` (gitignored).
- **Always Spanish:** OpenAI prompts and domain strings (`'nequi'`, `'consignación'`, etc.) —
  they process real Spanish-language input.
- Conversations with the agent may be in Spanish; deliverables follow the rules above.

## Official issue tracker

The project tracker is **GitHub Issues** on this repository (use `gh issue ...`).

- Workstream label prefixes: `wayfinder:*` (extraction accuracy map) and `platform:*`
  (infrastructure hardening).
- Type labels within each workstream: `task`, `research`.
- Every issue declares its dependencies in the body as `Blocked by: #N`.


