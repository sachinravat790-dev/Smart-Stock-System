import { createInterface } from "node:readline";
import bcrypt from "bcryptjs";
import { databasePool } from "./database.js";

function question(prompt) {
  return new Promise((resolve) => {
    const reader = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    reader.question(prompt, (answer) => {
      reader.close();
      resolve(answer.trim());
    });
  });
}

function hiddenQuestion(prompt) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("Run this command from an interactive terminal.");
  }

  return new Promise((resolve, reject) => {
    const input = process.stdin;
    const output = process.stdout;
    let answer = "";
    output.write(prompt);
    input.setRawMode(true);
    input.resume();

    const finish = (error) => {
      input.setRawMode(false);
      input.pause();
      input.off("data", onData);
      output.write("\n");
      if (error) reject(error);
      else resolve(answer);
    };

    const onData = (buffer) => {
      for (const character of buffer.toString("utf8")) {
        if (character === "\u0003") {
          finish(new Error("User creation cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u007f" || character === "\b") {
          answer = answer.slice(0, -1);
          continue;
        }
        answer += character;
      }
    };

    input.on("data", onData);
  });
}

async function createUser() {
  if (!databasePool) {
    throw new Error("SUPABASE_DB_URL is not configured.");
  }

  const name = await question("Name: ");
  const email = (await question("Email: ")).toLowerCase();
  const role = (await question("Role (owner/staff): ")).toLowerCase();

  if (!name || name.length > 120) {
    throw new Error("Name must contain between 1 and 120 characters.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error("Enter a valid email address.");
  }
  if (role !== "owner" && role !== "staff") {
    throw new Error("Role must be owner or staff.");
  }

  const password = await hiddenQuestion("Password (hidden): ");
  const confirmation = await hiddenQuestion("Confirm password (hidden): ");
  if (password !== confirmation) {
    throw new Error("Passwords do not match.");
  }
  if (password.length < 12 || Buffer.byteLength(password) > 72) {
    throw new Error("Password must be at least 12 characters and at most 72 bytes.");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await databasePool.query(
    `INSERT INTO public.users (name, email, password_hash, role)
     VALUES ($1, $2, $3, $4)`,
    [name, email, passwordHash, role],
  );
  console.log(`Created ${role} account in the Supabase users table.`);
}

async function resetStaffPassword() {
  if (!databasePool) {
    throw new Error("SUPABASE_DB_URL is not configured.");
  }

  const password = await hiddenQuestion("New Staff password (hidden): ");
  const confirmation = await hiddenQuestion("Confirm new password (hidden): ");
  if (password !== confirmation) {
    throw new Error("Passwords do not match.");
  }
  if (password.length < 12 || Buffer.byteLength(password) > 72) {
    throw new Error("Password must be at least 12 characters and at most 72 bytes.");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const client = await databasePool.connect();
  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE public.users IN SHARE ROW EXCLUSIVE MODE");
    const result = await client.query(
      "SELECT id FROM public.users WHERE role = $1 FOR UPDATE",
      ["staff"],
    );
    if (result.rowCount !== 1) {
      throw new Error("Expected exactly one Staff account; no account was changed.");
    }

    await client.query(
      `UPDATE public.users
       SET password_hash = $1, updated_at = now()
       WHERE id = $2 AND role = $3`,
      [passwordHash, result.rows[0].id, "staff"],
    );
    await client.query("COMMIT");
    console.log("Reset the password hash for the Staff account.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

try {
  const command = process.argv[2];
  if (!command) {
    await createUser();
  } else if (command === "--reset-staff") {
    await resetStaffPassword();
  } else {
    throw new Error("Usage: npm run user:create or npm run user:create -- --reset-staff");
  }
} catch (error) {
  if (error.code === "23505") {
    console.error("An account with this email already exists.");
  } else if (error.code) {
    console.error("Account creation failed with database error:", error.code);
  } else {
    console.error(error.message);
  }
  process.exitCode = 1;
} finally {
  await databasePool?.end();
}
