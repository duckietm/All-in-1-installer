# No Docker, permissions or external services are modified by wizard tests.
docker() { return 0; }
uname() { echo Linux; }
flock() { :; }
export -f docker uname flock
install() { :; }
chown() { :; }
stat() { echo 33:33; }
sudo() { "$@"; }
export -f install chown stat sudo
