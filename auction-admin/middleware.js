import { NextResponse } from 'next/server'

export function middleware(request) {
  if (request.nextUrl.pathname === '/login') {
    return NextResponse.next()
  }
  
  const adminAuth = request.cookies.get('admin_auth')
  
  if (!adminAuth) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  
  return NextResponse.next()
}

export const config = {
  matcher: '/',
}