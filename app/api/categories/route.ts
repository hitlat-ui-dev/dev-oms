import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import Category from "@/models/Category";
import mongoose from "mongoose";

export async function GET() {
  await clientPromise;
  if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env.MONGODB_URI!);
  const categories = await Category.find({});
  return NextResponse.json(categories);
}

export async function POST(req: Request) {
  const { name } = await req.json();
  await clientPromise;
  if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env.MONGODB_URI!);
  const newCat = await Category.create({ name });
  return NextResponse.json(newCat);
}