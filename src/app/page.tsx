import { getServerSession } from 'next-auth/next';
import { authOptions } from './api/auth/[...nextauth]/route';
import { redirect } from 'next/navigation';

export default async function Home() {
  let session = null;
  try {
    session = await getServerSession(authOptions);
  } catch (error) {
    console.error('Failed to retrieve server session:', error);
  }

  if (!session || !session.user) {
    redirect('/auth/connect');
  } else {
    redirect('/globe');
  }
}
