async function totalScore(userIds) {
  let total = 0;
  userIds.forEach(async (id) => {
    const user = await fetchUser(id);
    total += user.score;
  });
  return total;
}
