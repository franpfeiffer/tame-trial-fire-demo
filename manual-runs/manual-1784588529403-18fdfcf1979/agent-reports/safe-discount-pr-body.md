## What changed

The safe feature agent added support for the `WELCOME20` coupon.

## TAME decision

Allowed. The patch touched billing discount logic only and the generated risk score was below the blocking threshold.

## Validation

- TAME checked `apply_patch` before the file write
- The branch was pushed only after TAME allowed the tool call
