import { NextResponse } from "next/server";
import mongoose from "mongoose";
import Employee from "@/models/Employee";

// Vercel runs in UTC but the business day is IST, so a plain toISOString()
// date would land on "yesterday" for anything logged before 05:30 IST. Shift
// first, then read the UTC calendar date - same off-by-one this codebase
// avoids in Attendance.date.
function todayIST(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function connectMongoose() {
  if (mongoose.connection.readyState !== 1 && process.env.MONGODB_URI) {
    await mongoose.connect(process.env.MONGODB_URI);
  }
}

// GET /api/employees            - active employees only (the daily roster)
// GET /api/employees?all=1      - everyone, including deactivated ones
export async function GET(req: Request) {
  try {
    await connectMongoose();
    const { searchParams } = new URL(req.url);
    const includeInactive = searchParams.get("all") === "1";

    const employees = await Employee.find(includeInactive ? {} : { isActive: true })
      .sort({ name: 1 })
      .lean();

    return NextResponse.json(employees);
  } catch (error: any) {
    console.error("GET employees error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch employees" }, { status: 500 });
  }
}

// POST /api/employees                      - add one employee by hand
// POST /api/employees?action=import_users   - create an Employee for every OMS
//   login that doesn't have one yet, linked by username. Saves retyping the
//   staff who are already in the system, and is safe to re-run: usernames that
//   already have an employee are skipped, not duplicated.
export async function POST(req: Request) {
  try {
    await connectMongoose();
    const { searchParams } = new URL(req.url);

    if (searchParams.get("action") === "import_users") {
      const db = mongoose.connection.db;
      if (!db) throw new Error("Database instance unavailable");

      // Read the raw users collection rather than a Mongoose model - this app
      // keeps logins in plain Mongo (see app/api/login/route.ts), with no
      // Mongoose User model to import.
      const users = await db.collection("users").find({}, { projection: { username: 1 } }).toArray();

      const alreadyLinked = new Set(
        (await Employee.find({ linkedUsername: { $type: "string" } }, { linkedUsername: 1 }).lean())
          .map((e: any) => String(e.linkedUsername).toLowerCase())
      );

      const toCreate = users
        .map((u: any) => String(u.username || "").trim())
        .filter((username) => username && !alreadyLinked.has(username.toLowerCase()))
        .map((username) => ({ name: username, linkedUsername: username, isActive: true }));

      if (toCreate.length > 0) {
        await Employee.insertMany(toCreate);
      }

      return NextResponse.json({ success: true, imported: toCreate.length });
    }

    const body = await req.json();
    const name = (body?.name || "").trim();
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const employee = await Employee.create({
      name,
      employeeCode: (body.employeeCode || "").trim(),
      mobile: (body.mobile || "").trim(),
      designation: (body.designation || "").trim(),
      joiningDate: body.joiningDate ? new Date(body.joiningDate) : null,
      monthlySalary: Number(body.monthlySalary) || 0,
      // Record the starting salary as the first history row too, so "kab se
      // kitni salary thi" is answerable from day one rather than only from
      // the first increment onwards.
      salaryHistory:
        Number(body.monthlySalary) > 0
          ? [{
              date: (body.joiningDate || "").slice(0, 10) || todayIST(),
              oldSalary: 0,
              newSalary: Number(body.monthlySalary),
              note: "Starting salary",
              changedBy: (body.changedBy || "").toString(),
            }]
          : [],
      // Only set the field when there is an actual login to link, so the
      // partial unique index keeps ignoring unlinked employees.
      ...(body.linkedUsername ? { linkedUsername: String(body.linkedUsername).trim() } : {}),
      isActive: body.isActive !== false,
    });

    return NextResponse.json(employee, { status: 201 });
  } catch (error: any) {
    console.error("POST employees error:", error);
    if (error?.code === 11000) {
      return NextResponse.json({ error: "Is username ka employee pehle se hai." }, { status: 400 });
    }
    return NextResponse.json({ error: error.message || "Failed to save employee" }, { status: 500 });
  }
}

// PUT /api/employees - edit one employee (including activate/deactivate)
export async function PUT(req: Request) {
  try {
    await connectMongoose();
    const body = await req.json();
    const id = (body?._id || body?.id || "").toString();
    if (!id) {
      return NextResponse.json({ error: "_id is required" }, { status: 400 });
    }

    const update: Record<string, unknown> = {};
    if (body.name !== undefined) update.name = String(body.name).trim();
    if (body.employeeCode !== undefined) update.employeeCode = String(body.employeeCode).trim();
    if (body.mobile !== undefined) update.mobile = String(body.mobile).trim();
    if (body.designation !== undefined) update.designation = String(body.designation).trim();
    if (body.joiningDate !== undefined) update.joiningDate = body.joiningDate ? new Date(body.joiningDate) : null;
    if (body.isActive !== undefined) update.isActive = !!body.isActive;

    // A salary change goes through the same path as every other edit, and
    // appends its own history row automatically. Doing it here rather than in
    // a separate "increment" endpoint means the history can't be skipped by
    // whoever forgets to call the other one.
    let salaryEntry: Record<string, unknown> | null = null;
    if (body.monthlySalary !== undefined) {
      const newSalary = Number(body.monthlySalary) || 0;
      const current = await Employee.findById(id, { monthlySalary: 1 }).lean();
      if (!current) {
        return NextResponse.json({ error: "Employee not found" }, { status: 404 });
      }
      const oldSalary = Number((current as any).monthlySalary) || 0;
      if (newSalary !== oldSalary) {
        update.monthlySalary = newSalary;
        salaryEntry = {
          date: (body.effectiveDate || "").toString().slice(0, 10) || todayIST(),
          oldSalary,
          newSalary,
          note: (body.incrementNote || "").toString().trim(),
          changedBy: (body.changedBy || "").toString(),
        };
      }
    }

    const employee = await Employee.findByIdAndUpdate(
      id,
      salaryEntry ? { $set: update, $push: { salaryHistory: salaryEntry } } : update,
      { new: true }
    );
    if (!employee) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }
    return NextResponse.json(employee);
  } catch (error: any) {
    console.error("PUT employees error:", error);
    return NextResponse.json({ error: error.message || "Failed to update employee" }, { status: 500 });
  }
}

// DELETE /api/employees?id=... - deactivate, never actually delete.
// Attendance history refers to this employee; removing the row would leave
// past registers pointing at nothing.
export async function DELETE(req: Request) {
  try {
    await connectMongoose();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const employee = await Employee.findByIdAndUpdate(id, { isActive: false }, { new: true });
    if (!employee) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, deactivated: employee.name });
  } catch (error: any) {
    console.error("DELETE employees error:", error);
    return NextResponse.json({ error: error.message || "Failed to deactivate employee" }, { status: 500 });
  }
}
