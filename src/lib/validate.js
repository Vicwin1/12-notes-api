export function validate(schema, source = "body") {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      return res.status(422).json({
        error: {
          message: "Request validation failed.",
          details: result.error.flatten().fieldErrors,
        },
      });
    }

    if (source === "body") {
      req.body = result.data;
    } else {
      req.validated ??= {};
      req.validated[source] = result.data;
    }
    return next();
  };
}
