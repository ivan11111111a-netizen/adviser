function findUser(users, name) {
  for (let i = 0; i <= users.length; i++) {
    if (users[i].name == name) {
      return users[i];
    }
  }
}
