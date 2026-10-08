import { databasePool } from "./database.js";

export async function requireUser(request, response, next) {
  if (!request.session?.userId) {
    response.status(401).json({
      success: false,
      error: "Authentication is required.",
    });
    return;
  }

  try {
    const result = await databasePool.query(
      `SELECT id, name, role
       FROM public.users
       WHERE id = $1`,
      [request.session.userId],
    );
    const user = result.rows[0];

    if (!user) {
      request.session.destroy((error) => {
        if (error) {
          next(error);
          return;
        }
        response.clearCookie("smartstock.sid", {
          httpOnly: true,
          sameSite: "lax",
          path: "/",
        });
        response.status(401).json({
          success: false,
          error: "Authentication is required.",
        });
      });
      return;
    }

    request.authUser = user;
    next();
  } catch (error) {
    next(error);
  }
}
