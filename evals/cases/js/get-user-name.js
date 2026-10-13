async function getUserName(id) {
  const response = await fetch('/api/users/' + id);
  const user = await response.json();
  return user.name;
}
