"use client";
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
export default function AccountPage() { const [user,setUser]=useState<{email:string;role:string}|null>(null); const router=useRouter(); useEffect(()=>{fetch('/api/auth/session').then(r=>r.ok?r.json():null).then(v=>setUser(v?.user??null));},[]); if(!user)return <main className="content"><h1>Account</h1><p>You are not signed in.</p><a href="/login">Sign in</a></main>; return <main className="content"><h1>Account</h1><p>{user.email}</p><p>Role: {user.role}</p><button onClick={async()=>{await fetch('/api/auth/session',{method:'DELETE'});router.push('/login');}}>Sign out</button></main>; }
