interface User {
  name: string;
  email?: string;
}

function firstEmail(users: User[]): string {
  return users[0].email!;
}
